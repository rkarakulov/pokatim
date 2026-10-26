// Metro отдаёт картинку как числовой id ассета (ImageRequireSource)
declare module '*.png' {
  const asset: number;
  export default asset;
}

// Metro web подключает CSS побочным импортом (стили `maplibre-gl` в `*.web.tsx`)
declare module '*.css';
