// Minimal types for the bwip-js "browser" subpath export. tsc's moduleResolution:node
// can't read the package's exports map, so we declare the module here. We only use toSVG.
declare module 'bwip-js/browser' {
    export interface RenderOptions {
        bcid: string;
        text: string;
        scale?: number;
        height?: number;
        width?: number;
        includetext?: boolean;
        textxalign?: string;
        paddingwidth?: number;
        paddingheight?: number;
        [key: string]: unknown;
    }
    export function toSVG(opts: RenderOptions): string;
}
