/**
 * The single answer to "what can be uploaded".
 *
 * There used to be three answers that disagreed. Multer accepted anything with
 * a `video/*` mimetype, the byte sniffer accepted Matroska, MPEG program
 * streams and FLV, and Supabase storage accepted only mp4/mov/avi. A valid
 * .mkv or .webm therefore cleared the first two gates, got measured, and then
 * died inside the storage call with "Invalid file extension" — which the
 * upload handler could only report as a 500.
 */

export type VideoContainer = 'iso-bmff' | 'avi' | 'matroska' | 'mpeg-ps' | 'flv';

/** Containers the storage bucket and the render path both accept. */
export const SUPPORTED_CONTAINERS: ReadonlySet<VideoContainer> = new Set<VideoContainer>([
  'iso-bmff',
  'avi',
]);

export const SUPPORTED_EXTENSIONS: readonly string[] = ['.mp4', '.mov', '.avi'];

export const SUPPORTED_MIME_TYPES: readonly string[] = [
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
];

/** What to call a container in a message aimed at the person who uploaded it. */
const CONTAINER_LABELS: Record<VideoContainer, string> = {
  'iso-bmff': 'MP4/MOV',
  avi: 'AVI',
  matroska: 'Matroska or WebM',
  'mpeg-ps': 'MPEG program stream',
  flv: 'Flash Video',
};

export const SUPPORTED_FORMATS_PHRASE = 'MP4, MOV, or AVI';

export function isSupportedContainer(container: VideoContainer | null): boolean {
  return container !== null && SUPPORTED_CONTAINERS.has(container);
}

/**
 * Message for a file that really is a video, in a container we can't take.
 * Naming the format is the difference between a user converting the file and
 * a user filing a bug.
 */
export function unsupportedContainerMessage(container: VideoContainer): string {
  return `This is a ${CONTAINER_LABELS[container]} file, which we can't reframe yet. Please convert it to ${SUPPORTED_FORMATS_PHRASE} and try again.`;
}

export function unsupportedExtensionMessage(extension: string): string {
  return `We can't reframe ${extension} files. Please upload ${SUPPORTED_FORMATS_PHRASE}.`;
}
