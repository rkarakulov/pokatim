import type { ImageSourcePropType } from 'react-native';

import footer26 from '../../../assets/images/pwa-install/footer-26.png';
import footerOld from '../../../assets/images/pwa-install/footer-old.png';
import header from '../../../assets/images/pwa-install/header.png';
import shareButton26 from '../../../assets/images/pwa-install/share-button-26.png';
import shareButtonOld from '../../../assets/images/pwa-install/share-button-old.png';

/** Картинка во всю ширину с исходной пропорцией (`width: 100%; height: auto`). */
export interface InstallImage {
  source: ImageSourcePropType;
  aspectRatio: number;
}

const image = (source: ImageSourcePropType, width: number, height: number): InstallImage => ({
  source,
  aspectRatio: width / height,
});

/** Иконка на экране «Домой» — шапка инструкции и промо. */
export const INSTALL_HEADER = image(header, 824, 278);

/** Шаги инструкции iOS: «Поделиться» и «На экран „Домой“» — свои для Safari iOS 26+ и для остальных. */
export const INSTALL_STEPS: Record<
  'ios26' | 'legacy',
  { share: InstallImage; addToHome: InstallImage }
> = {
  ios26: { share: image(shareButton26, 824, 358), addToHome: image(footer26, 824, 238) },
  legacy: { share: image(shareButtonOld, 728, 338), addToHome: image(footerOld, 728, 282) },
};
