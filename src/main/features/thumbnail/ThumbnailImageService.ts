import { nativeImage } from 'electron'

export interface ThumbnailJpeg {
    buffer: Buffer
    width: number
    height: number
}

export function createThumbnailJpeg(input: Buffer): ThumbnailJpeg {
    if (input.length === 0 || input.length > 8 * 1024 * 1024) {
        throw new Error('THUMBNAIL_INPUT_INVALID')
    }

    const original = nativeImage.createFromBuffer(input)

    if (original.isEmpty()) {
        throw new Error('THUMBNAIL_DECODE_FAILED')
    }

    const size = original.getSize()

    if (size.width <= 0 || size.height <= 0 || size.width * size.height > 40_000_000) {
        throw new Error('THUMBNAIL_DIMENSIONS_INVALID')
    }

    const scale = Math.min(1, 480 / Math.max(size.width, size.height))

    const width = Math.max(1, Math.round(size.width * scale))
    const height = Math.max(1, Math.round(size.height * scale))

    const resized =
        scale < 1
            ? original.resize({
                  width,
                  height,
                  quality: 'best'
              })
            : original

    const buffer = resized.toJPEG(80)

    if (buffer.length === 0) {
        throw new Error('THUMBNAIL_ENCODE_FAILED')
    }

    return { buffer, width, height }
}

export function inspectThumbnailJpeg(input: Buffer): { width: number; height: number } {
    if (
        input.length < 3 ||
        input.length > 8 * 1024 * 1024 ||
        input[0] !== 0xff ||
        input[1] !== 0xd8 ||
        input[2] !== 0xff
    ) {
        throw new Error('THUMBNAIL_JPEG_INVALID')
    }

    const image = nativeImage.createFromBuffer(input)

    if (image.isEmpty()) {
        throw new Error('THUMBNAIL_DECODE_FAILED')
    }

    const { width, height } = image.getSize()

    if (width < 1 || height < 1 || Math.max(width, height) > 480) {
        throw new Error('THUMBNAIL_DIMENSIONS_INVALID')
    }

    return { width, height }
}
