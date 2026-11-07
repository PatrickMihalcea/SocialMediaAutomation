"""
Keeps every attention matrix under Apple's MPS tensor-size limit.

ComfyUI's split attention only slices the query when it thinks memory is
short. On a 128 GB Mac it never is, so it builds the whole
(batch*heads, N, N) score matrix at once. Past 2**32 elements that crashes
MPS outright (a segfault inside einsum), which is what killed LTX-2.5 at
704x1280 for 5 s: 32 heads x 14,080 tokens squared is 6.3 billion.

This is ComfyUI's attention_split with one change: the query is always cut
into slices whose score matrix stays at or under CHUNK_ELEMENTS, whatever
memory says. The arithmetic is identical, so the output is too; it just runs
as more, smaller matrix multiplies. Loaded only by the instance that lists
this folder; nothing in the ComfyUI install is modified.
"""
import logging
import math

import torch
from torch import einsum

import comfy.ldm.modules.attention as A
from comfy import model_management

CHUNK_ELEMENTS = 2 ** 29  # 1 GiB of bf16 scores per slice; MPS fails past 2**32


@A.wrap_attn
def attention_split_chunked(q, k, v, heads, mask=None, attn_precision=None, skip_reshape=False, skip_output_reshape=False, **kwargs):
    attn_precision = A.get_attn_precision(attn_precision, q.dtype)

    if skip_reshape:
        b, _, _, dim_head = q.shape
    else:
        b, _, dim_head = q.shape
        dim_head //= heads

    scale = kwargs.get("scale", dim_head ** -0.5)

    if skip_reshape:
        if kwargs.get("enable_gqa", False):
            k, v = A.comfy.ops.repeat_kv_for_gqa(k, v, q.shape[-3], -3)
        q, k, v = map(lambda t: t.reshape(b * heads, -1, dim_head), (q, k, v))
    else:
        q, k, v = A._reshape_qkv_to_heads(q, k, v, b, heads, dim_head, kwargs.get("enable_gqa", False))
        q, k, v = map(lambda t: t.permute(0, 2, 1, 3).reshape(b * heads, -1, dim_head).contiguous(), (q, k, v))

    r1 = torch.zeros(q.shape[0], q.shape[1], v.shape[2], device=q.device, dtype=q.dtype)
    upcast = attn_precision == torch.float32

    if mask is not None:
        bs = 1 if len(mask.shape) == 2 else mask.shape[0]
        mask = mask.reshape(bs, -1, mask.shape[-2], mask.shape[-1]).expand(b, heads, -1, -1).reshape(-1, mask.shape[-2], mask.shape[-1])

    rows = q.shape[1]
    per_row = q.shape[0] * k.shape[1]
    slice_size = max(1, min(rows, CHUNK_ELEMENTS // max(1, per_row)))

    for i in range(0, rows, slice_size):
        end = min(i + slice_size, rows)
        if upcast:
            s1 = einsum('b i d, b j d -> b i j', q[:, i:end].float(), k.float()) * scale
        else:
            s1 = einsum('b i d, b j d -> b i j', q[:, i:end], k) * scale
        if mask is not None:
            if len(mask.shape) == 2:
                s1 += mask[i:end]
            elif mask.shape[1] == 1:
                s1 += mask
            else:
                s1 += mask[:, i:end]
        s2 = s1.softmax(dim=-1).to(v.dtype)
        del s1
        r1[:, i:end] = einsum('b i j, b j d -> b i d', s2, v)
        del s2

    del q, k, v
    r1 = r1.unsqueeze(0).reshape(b, heads, -1, dim_head)
    if not skip_output_reshape:
        r1 = r1.permute(0, 2, 1, 3).reshape(b, -1, heads * dim_head)
    return r1


if A.optimized_attention is A.attention_split:
    A.optimized_attention = attention_split_chunked
    A.optimized_attention_masked = attention_split_chunked
    logging.info("[mps_attention_chunks] split attention now slices to %d elements per score matrix", CHUNK_ELEMENTS)
else:
    logging.warning("[mps_attention_chunks] split attention is not in use; leaving attention alone")

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
