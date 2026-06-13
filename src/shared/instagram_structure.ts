import type { ExternalMediaStructure } from './external_structure'

export interface InstagramStructure extends ExternalMediaStructure {
    downloader: 'gallery-dl'
    site: 'instagram'

    post_id?: string
    post_shortcode?: string

    sidecar_media_id?: string
    sidecar_shortcode?: string

    owner_id?: string
    username?: string
    fullname?: string

    post_date?: string
    date?: string

    type?: 'post' | 'reel' | 'story' | string
    post_url?: string

    count?: number
    category?: 'instagram' | string
    subcategory?: string
    num?: number

    media_id?: string
    shortcode?: string

    display_url?: string
    video_url?: string | null

    width?: number
    width_original?: number
    height?: number
    height_original?: number

    tagged_users?: unknown[]
}
