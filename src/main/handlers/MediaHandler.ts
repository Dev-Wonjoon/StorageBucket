import { MediaService } from "../services/MediaService";

export const mediaHandler = {
    'media:get-all': async () => {
        return await MediaService.getAll();
    }
}