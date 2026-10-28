import VideoToolsPage from './VideoToolsPage';
import { useAuth } from '../contexts/AuthContext';

export default function VideoUpscalePage() {
  const { user } = useAuth();
  return <VideoToolsPage key={`upscale:${user?.id ?? 'signed-out'}`} kind="upscale" />;
}
