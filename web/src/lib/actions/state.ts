import { z } from 'zod';
import { toAppError } from '@/lib/errors';

export type ActionState = {
  status?: 'error' | 'success';
  error?: string;
  success?: string;
  fields?: Record<string, string[]>;
};

export const initialActionState: ActionState = {};

export function actionSuccess(message: string): ActionState {
  return { status: 'success', success: message };
}

export function actionError(error: unknown, fallback?: string): ActionState {
  if (error instanceof z.ZodError) {
    const fields = Object.fromEntries(
      Object.entries(error.flatten().fieldErrors).filter(
        (entry): entry is [string, string[]] => Array.isArray(entry[1]),
      ),
    );
    return {
      status: 'error',
      error: fallback ?? error.issues[0]?.message ?? 'Check the highlighted fields.',
      fields,
    };
  }
  const appError = toAppError(error);
  return { status: 'error', error: appError.message, fields: appError.fields };
}

export function firstFieldError(state: ActionState, field: string): string | undefined {
  return state.fields?.[field]?.[0];
}
