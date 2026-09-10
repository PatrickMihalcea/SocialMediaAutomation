import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireWorkspace } from '@/lib/auth/guard';
import { listConversations, sendAssistantMessage } from '@/lib/ai/conversations';
import { toAppError } from '@/lib/errors';

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const ctx = await requireWorkspace(slug, 'ai:use');
    return NextResponse.json({ data: await listConversations(ctx.workspace.id, ctx.user.id) });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json({ error: appError.message }, { status: appError.status });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const ctx = await requireWorkspace(slug, 'ai:use');
    const input = z.object({
      conversationId: z.string().uuid().optional(),
      content: z.string().min(1).max(20_000),
    }).parse(await request.json());
    return NextResponse.json({
      data: await sendAssistantMessage({
        workspaceId: ctx.workspace.id,
        userId: ctx.user.id,
        ...input,
      }),
    });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json({ error: appError.message }, { status: appError.status });
  }
}
