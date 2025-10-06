import { ImageResponse } from 'next/og';

export const size = {
  width: 32,
  height: 32,
};

export const contentType = 'image/png';

export default function Icon() {
  // Generate a fully transparent favicon to remove any default "N" icon.
  return new ImageResponse(
    (
      <div
        style={{
          width: size.width,
          height: size.height,
          background: 'transparent',
        }}
      />
    ),
    size,
  );
}

