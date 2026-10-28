import VideoToolsPage from './VideoToolsPage';
import { useAuth } from '../contexts/AuthContext';

export default function WanPlaygroundPage() {
  const { user } = useAuth();
  return <VideoToolsPage key={`wan:${user?.id ?? 'signed-out'}`} kind="wan" />;
}
