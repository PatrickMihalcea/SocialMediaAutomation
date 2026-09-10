import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  BadgeCheck,
  Briefcase,
  Camera,
  CheckCircle2,
  CircleDashed,
  FilePenLine,
  ListTodo,
  LoaderCircle,
  MessageSquare,
  Music,
  Play,
  ShieldAlert,
  Users,
  XCircle,
} from 'lucide-react';

export const PLATFORM_ICONS: Record<string, LucideIcon> = {
  INSTAGRAM: Camera,
  FACEBOOK: Users,
  LINKEDIN: Briefcase,
  X: MessageSquare,
  TIKTOK: Music,
  YOUTUBE: Play,
  MOCK: CircleDashed,
};

export const STATUS_ICONS: Record<string, LucideIcon> = {
  DRAFT: FilePenLine,
  PENDING_APPROVAL: ShieldAlert,
  APPROVED: BadgeCheck,
  SCHEDULED: ListTodo,
  PUBLISHING: LoaderCircle,
  PUBLISHED: CheckCircle2,
  FAILED: AlertTriangle,
  CANCELLED: XCircle,
};

export function PlatformGlyph({ platform, size = 14 }: { platform: string; size?: number }) {
  const Icon = PLATFORM_ICONS[platform] ?? CircleDashed;
  return <Icon size={size} strokeWidth={1.75} aria-hidden />;
}

export function StatusGlyph({ status, size = 14 }: { status: string; size?: number }) {
  const Icon = STATUS_ICONS[status] ?? CircleDashed;
  return <Icon size={size} strokeWidth={1.75} aria-hidden />;
}
