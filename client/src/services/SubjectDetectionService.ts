import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-webgl';

// Note: We're using a simplified approach with coco-ssd model
// which is optimized for browser use

export interface DetectedObject {
  id: string;
  bbox: [number, number, number, number]; // [x, y, width, height] in pixels
  class: string;
  score: number;
}

export interface DetectionResult {
  objects: DetectedObject[];
  imageWidth: number;
  imageHeight: number;
  error?: string;
}

class SubjectDetectionService {
  private model: any = null;
  private loading: boolean = false;
  private modelLoaded: boolean = false;

  /**
   * Initialize the detection service
   */
  async initialize(): Promise<void> {
    return this.loadModel();
  }

  /**
   * Load the model
   */
  async loadModel(): Promise<void> {
    if (this.modelLoaded) {
      console.log('Model already loaded, reusing existing model');
      return; // Model already loaded
    }

    if (this.loading) {
      console.log('Model is currently loading, waiting...');
      // Wait for current loading process to complete
      while (this.loading) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return;
    }

    try {
      this.loading = true;
      console.log('Loading COCO-SSD model...');
      
      // Check if TensorFlow is available
      if (!tf) {
        console.error('TensorFlow is not defined! Check if @tensorflow/tfjs is installed correctly');
        throw new Error('TensorFlow is not available');
      }
      
      console.log('TensorFlow version:', tf.version);
      console.log('TensorFlow backend:', tf.getBackend());
      
      // Ensure WebGL backend is ready
      if (tf.getBackend() !== 'webgl') {
        console.log('Setting WebGL backend...');
        try {
          await tf.setBackend('webgl');
          console.log('Successfully set WebGL backend');
        } catch (err) {
          console.error('Error setting WebGL backend:', err);
          console.log('Falling back to CPU backend');
        }
      }

      // Dynamically import the coco-ssd model
      try {
        console.log('Dynamically importing coco-ssd model...');
        const cocoSsd = await import('@tensorflow-models/coco-ssd');
        console.log('coco-ssd import successful:', !!cocoSsd);
        
        // Load the model - this is optimized for browser use
        console.log('Loading model...');
        this.model = await cocoSsd.load();
        console.log('Model loading successful:', !!this.model);

        this.modelLoaded = true;
        console.log('COCO-SSD model loaded successfully');
        } catch (importError) {
          console.error('Error importing coco-ssd model:', importError);
          const errorMessage = importError instanceof Error ? importError.message : String(importError);
          throw new Error(`Failed to import coco-ssd: ${errorMessage}`);
        }
      } catch (error) {
        console.error('Error loading COCO-SSD model:', error);
        this.modelLoaded = false;
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(errorMessage);
      } finally {
        this.loading = false;
      }
    }

  /**
   * Detect objects in the provided image
   */
  async detectObjects(image: HTMLImageElement | HTMLCanvasElement): Promise<DetectionResult> {
    console.log('Starting object detection...');
    
    if (!this.modelLoaded) {
      try {
        await this.loadModel();
      } catch (error) {
        return {
          objects: [],
          imageWidth: image.width,
          imageHeight: image.height,
          error: 'Failed to load the object detection model'
        };
      }
    }

    if (!this.model) {
      return {
        objects: [],
        imageWidth: image.width,
        imageHeight: image.height,
        error: 'Model not loaded'
      };
    }

    const imageWidth = image.width;
    const imageHeight = image.height;
    console.log(`Detecting objects in image (${imageWidth}x${imageHeight})`);
    
    let objects: DetectedObject[] = [];

    try {
      // Run inference - coco-ssd handles tensor conversion internally
      const predictions = await this.model.detect(image);
      console.log('Detection complete, found', predictions.length, 'objects');
      
      // Convert to our DetectedObject format
      objects = predictions.map((pred: any, i: number) => {
        // bbox is in format [x, y, width, height]
        return {
          id: `detection-${i}`,
          bbox: pred.bbox as [number, number, number, number],
          class: pred.class,
          score: pred.score
        };
      });
    } catch (error) {
      console.error('Error during object detection:', error);
      return {
        objects: [],
        imageWidth,
        imageHeight,
        error: 'Failed to perform object detection'
      };
    }

    return {
      objects,
      imageWidth,
      imageHeight
    };
  }

  /**
   * Method for backward compatibility
   */
  async detectObjectsInCanvas(canvas: HTMLCanvasElement): Promise<DetectedObject[]> {
    const result = await this.detectObjects(canvas);
    return result.objects;
  }

  /**
   * Convert detection results to focus points
   */
  convertToFocusPoints(
    detectionResult: DetectionResult, 
    currentTime: number, 
    duration: number = 5
  ): Array<{
    id: string;
    timeStart: number;
    timeEnd: number;
    x: number;
    y: number;
    width: number;
    height: number;
    description: string;
  }> {
    const { objects, imageWidth, imageHeight } = detectionResult;
    
    // Convert detected objects to focus points
    return objects.map(obj => {
      // Convert pixel coordinates to percentages
      const [x, y, width, height] = obj.bbox;
      
      return {
        id: `focus-${Date.now()}-${obj.id}`,
        timeStart: currentTime,
        timeEnd: currentTime + duration,
        x: (x / imageWidth) * 100,
        y: (y / imageHeight) * 100,
        width: (width / imageWidth) * 100,
        height: (height / imageHeight) * 100,
        description: `${obj.class} (${Math.round(obj.score * 100)}% confidence)`
      };
    });
  }
}

// Export a singleton instance
const service = new SubjectDetectionService();
export default service;
