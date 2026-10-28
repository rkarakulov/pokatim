/** Ленивая загрузка `expo-image-picker` (только native, после `imagePickerSupported()`); точка подмены в jest. */
export const loadImagePicker = () => import('expo-image-picker');
