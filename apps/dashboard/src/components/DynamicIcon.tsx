import {
  Monitor,
  Code,
  Wallet,
  Video,
  BarChart3,
  Wrench,
  User,
  type LucideProps,
} from 'lucide-react';
import type { IconName } from '../config/ai-employees.config';

const iconMap: Record<IconName, React.ComponentType<LucideProps>> = {
  Monitor,
  Code,
  Wallet,
  Video,
  BarChart3,
  Wrench,
  User,
};

interface DynamicIconProps extends LucideProps {
  name: IconName;
}

export function DynamicIcon({ name, ...props }: DynamicIconProps) {
  const Icon = iconMap[name] || User;
  return <Icon {...props} />;
}
