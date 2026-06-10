// ESM wrapper — re-exports compiled CJS for contract manual:bash tests
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(__filename);

const svc = require(path.resolve(__dirname, '../../dist/services/video-remake.service.js'));

export const createVideoRemakeJob = svc.createVideoRemakeJob;
export const getVideoRemakeJob = svc.getVideoRemakeJob;
export const extractFrames = svc.extractFrames;
export const analyzeSceneFrame = svc.analyzeSceneFrame;
export const redrawFrameWithToAPI = svc.redrawFrameWithToAPI;
export const evaluateFrameScores = svc.evaluateFrameScores;
export const approveN06Review = svc.approveN06Review;
export const selectN07Frame = svc.selectN07Frame;
export const generateVideoWithDashScope = svc.generateVideoWithDashScope;
export const getVideoRemakeOutput = svc.getVideoRemakeOutput;
