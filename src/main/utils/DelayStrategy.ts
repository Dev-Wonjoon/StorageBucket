const FAST_DOMAINS = [
    'youtube.com',
    'youtu.be',
];

export const isFastDomain = (url: string): boolean => {
    return FAST_DOMAINS.some(domain => url.includes(domain));
};

const getRandomInt = (min: number, max: number): number => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

export const calculateJobDelay = (url: string): number => {
    if(isFastDomain(url)) {
        console.log(`[DelayStrategy] Fast Mode: ${url}`);
        return getRandomInt(1000, 3000);
    } else {
        console.log(`[DelayStrategy] Safe Mode: ${url}`);
        return getRandomInt(5000, 20000)
    }
}