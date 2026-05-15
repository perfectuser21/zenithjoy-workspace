"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiVideoController = void 0;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const ai_video_service_1 = require("../services/ai-video.service");
const ai_video_upload_service_1 = require("../services/ai-video-upload.service");
const aiVideoService = new ai_video_service_1.AiVideoService();
const uploadService = new ai_video_upload_service_1.AiVideoUploadService();
const LOCAL_BASE = `${process.env.HOME}/video-pipeline/jobs`;
class AiVideoController {
    async getAllGenerations(req, res, next) {
        try {
            const { status, limit, offset } = req.query;
            const result = await aiVideoService.getAllGenerations({
                status: status,
                limit: limit ? parseInt(limit) : 20,
                offset: offset ? parseInt(offset) : 0,
            });
            res.json(result);
        }
        catch (error) {
            next(error);
        }
    }
    async getGenerationById(req, res, next) {
        try {
            const { id } = req.params;
            const generation = await aiVideoService.getGenerationById(id);
            if (!generation) {
                return res.status(404).json({ error: 'Video generation not found' });
            }
            res.json(generation);
        }
        catch (error) {
            next(error);
        }
    }
    async getActiveGenerations(req, res, next) {
        try {
            const generations = await aiVideoService.getActiveGenerations();
            res.json(generations);
        }
        catch (error) {
            next(error);
        }
    }
    async createGeneration(req, res, next) {
        try {
            const generation = await aiVideoService.createGeneration(req.body);
            res.status(201).json(generation);
        }
        catch (error) {
            next(error);
        }
    }
    async updateGeneration(req, res, next) {
        try {
            const { id } = req.params;
            const generation = await aiVideoService.updateGeneration(id, req.body);
            res.json(generation);
        }
        catch (error) {
            next(error);
        }
    }
    async deleteGeneration(req, res, next) {
        try {
            const { id } = req.params;
            await aiVideoService.deleteGeneration(id);
            res.status(204).send();
        }
        catch (error) {
            next(error);
        }
    }
    async uploadAndProcess(req, res, next) {
        try {
            const files = req.files;
            const videoFile = files?.['video']?.[0];
            const logoFile = files?.['logo']?.[0];
            if (!videoFile) {
                return res.status(400).json({ error: 'video file is required' });
            }
            const scriptText = (req.body.script || req.body.title || '').trim();
            if (!scriptText) {
                return res.status(400).json({ error: 'script or title is required' });
            }
            const jobId = req.jobId;
            await uploadService.createJob({
                jobId,
                videoPath: videoFile.path,
                scriptText,
                logoPath: logoFile?.path,
            });
            // Fire and forget dispatch (async).
            // dispatch() uses execSync(ssh/scp) which blocks the Node.js event loop.
            // Calling getGenerationById() after this point risks pg-pool connectionTimeoutMillis
            // firing before the event loop unblocks. Return the known data instead.
            uploadService.dispatch({
                jobId,
                videoPath: videoFile.path,
                scriptText,
                logoPath: logoFile?.path,
            }).catch((err) => {
                console.error(`[upload] dispatch error for ${jobId}:`, err);
            });
            res.status(201).json({ id: jobId, status: 'queued', progress: 0, script_text: scriptText });
        }
        catch (error) {
            next(error);
        }
    }
    async downloadFile(req, res, next) {
        try {
            const { jobId, file } = req.params;
            // Sanitize path components
            if (!/^[\w-]+$/.test(jobId) || !/^[\w.-]+$/.test(file)) {
                return res.status(400).json({ error: 'invalid path' });
            }
            const filePath = path.join(LOCAL_BASE, jobId, 'out', file);
            if (!fs.existsSync(filePath)) {
                return res.status(404).json({ error: 'file not found' });
            }
            res.download(filePath);
        }
        catch (error) {
            next(error);
        }
    }
}
exports.AiVideoController = AiVideoController;
