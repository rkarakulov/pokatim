export { MediaModule } from './media.module';
export { MEDIA_POLICY } from './media.policy';
export { detectImageFormat, type ImageFormat } from './image-format';
export {
  decodeOriented,
  type ImageFailure,
  type ImageInspection,
  type ImageResult,
  inspectImage,
  processCover,
} from './image-pipeline';
export {
  ImageProcessing,
  ImageProcessingGate,
  ImageUploadSlots,
  type ProcessingGateLimits,
  type ProcessingPermit,
} from './image-processing';
export { replyJpeg } from './image-reply';
