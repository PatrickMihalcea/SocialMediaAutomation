import { NextResponse } from 'next/server';
import { requireWorkspace } from '@/lib/auth/guard';
import { confirmProposal } from '@/lib/ai/conversations';
import { toAppError } from '@/lib/errors';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ slug: string; messageId: string }> },
) {
  try {
    const { slug, messageId } = await params;
    const ctx = await requireWorkspace(slug, 'ai:use');
    return NextResponse.json({
      data: await confirmProposal({
        workspaceId: ctx.workspace.id,
        userId: ctx.user.id,
        role: ctx.role,
        messageId,
      }),
    });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json({ error: appError.message }, { status: appError.status });
  }
}
