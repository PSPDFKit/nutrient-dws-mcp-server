/**
 * Represents a reference to a file, including its metadata and optional content.
 *
 * This type can be used to store information about a file, such as its identifier,
 * content, location, or any associated metadata. It supports both local files or a file fetch from a URL.
 *
 * Properties:
 * - `key` (string): A unique identifier or key for the file reference.
 * - `file` (optional): An object containing details about a local file, including:
 *   - `buffer` (Buffer): The file data stored in a buffer.
 *   - `path` (string): The filesystem path to the file.
 * - `url` (optional, string): The URL location of the file, if applicable.
 * - `name` (string): The name of the file.
 * - `password` (optional, string): A password to access the file, if required.
 */
export type FileReference = {
  key: string
  file?: {
    buffer: Buffer
    path: string
  }
  url?: string
  name: string
  password?: string
}
