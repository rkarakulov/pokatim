/** Выбранный файл заезда: имя и размер — для pre-check, тело читает платформенная отправка (`upload-track`). */
export interface PickedTrackFile {
  name: string;
  size: number;
  /** native — `file://` копии в кеше приложения; web — `blob:` URL */
  uri: string;
  /** web — сам `File` из `<input type="file">` */
  file?: Blob;
}
