export interface GalleryDlProfile {
    id: string
    platformName: string
    hosts: readonly string[]
    pathname: RegExp
    requestIdGroup: number
    trackingParameters: readonly string[]
    category: string
    subcategories: readonly string[]

    fields: {
        requestId: string
        postId: string
        fileId: string
        ownerId: string
        ownerName: string
        count: string
    }

    completeness: {
        typeField: string
        singleTypes: Readonly<Record<string, 'image' | 'video'>>
        fileIdEqualsPostId: boolean
    }

    discoveryOptions: Readonly<Record<string, unknown>>
}

export const galleryDlProfiles: readonly GalleryDlProfile[] = [
    {
        id: 'instagram',
        platformName: 'Instagram',
        hosts: ['instagram.com', 'www.instagram.com'],
        pathname: /^\/(p|reel)\/([A-Za-z0-9_-]{1,32})\/?$/,
        requestIdGroup: 2,
        trackingParameters: ['igsh', 'igshid'],
        category: 'instagram',
        subcategories: ['post', 'reel'],

        fields: {
            requestId: 'post_shortcode',
            postId: 'post_id',
            fileId: 'media_id',
            ownerId: 'owner_id',
            ownerName: 'username',
            count: 'count'
        },

        completeness: {
            typeField: 'typename',
            singleTypes: {
                GraphImage: 'image',
                GraphVideo: 'video'
            },
            fileIdEqualsPostId: true
        },

        discoveryOptions: {
            'extractor.instagram.api': 'graphql',
            'extractor.instagram.videos': 'merged',
            'extractor.instagram.audio': false,
            'extractor.instagram.previews': false,
            'output.num-to-str': true
        }
    }
]
