declare module "pdfjs-dist/build/pdf.mjs" {
  export function getDocument(src: unknown): {
    promise: Promise<{
      numPages: number;
      getPage(pageNumber: number): Promise<{
        getViewport(options: { scale: number }): {
          width: number;
          height: number;
        };
        render(options: {
          canvasContext: unknown;
          viewport: unknown;
        }): {
          promise: Promise<void>;
        };
      }>;
    }>;
    destroy(): Promise<void>;
  };
}

declare module "pdfjs-dist/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}

declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  export function getDocument(src: unknown): {
    promise: Promise<{
      numPages: number;
      getPage(pageNumber: number): Promise<{
        getViewport(options: { scale: number }): {
          width: number;
          height: number;
        };
        render(options: {
          canvasContext: unknown;
          viewport: unknown;
        }): {
          promise: Promise<void>;
        };
      }>;
    }>;
    destroy(): Promise<void>;
  };
}

declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
