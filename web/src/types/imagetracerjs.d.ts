declare module "imagetracerjs" {
    type ImageTracerOptions = {
        ltres?: number;
        qtres?: number;
        pathomit?: number;
        colorsampling?: number;
        numberofcolors?: number;
        mincolorratio?: number;
        colorquantcycles?: number;
        scale?: number;
        simplifytolerance?: number;
        roundcoords?: number;
        lcpr?: number;
        qcpr?: number;
        desc?: boolean;
        viewbox?: boolean;
        blurradius?: number;
        blurdelta?: number;
        linefilter?: boolean;
    };

    const ImageTracer: {
        imagedataToSVG(imageData: ImageData, options?: ImageTracerOptions): string;
    };

    export default ImageTracer;
}
