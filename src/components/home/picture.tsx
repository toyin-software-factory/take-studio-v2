import { HOME_IMAGES, type HomeImage, imagePath, imageSrcSet, largestWidth } from "./media";

/**
 * One homepage image as `<picture>`: AVIF, then WebP, then JPEG, with a width `srcset` and the
 * size attributes that keep the layout from shifting. Decorative images pass `alt=""`.
 */
export function Picture({
  name,
  alt,
  sizes,
  priority = false,
  className,
  check,
}: {
  readonly name: HomeImage;
  readonly alt: string;
  readonly sizes: string;
  readonly priority?: boolean;
  readonly className?: string;
  /** The `data-check` label for the design check (tools/design-check), when the draft tags this image. */
  readonly check?: string;
}) {
  const width = largestWidth(name);
  const [rw, rh] = HOME_IMAGES[name].ratio;
  const height = Math.round((width * rh) / rw);
  return (
    <picture>
      <source type="image/avif" srcSet={imageSrcSet(name, "avif")} sizes={sizes} />
      <source type="image/webp" srcSet={imageSrcSet(name, "webp")} sizes={sizes} />
      <img
        src={imagePath(name, width, "jpg")}
        srcSet={imageSrcSet(name, "jpg")}
        sizes={sizes}
        alt={alt}
        width={width}
        height={height}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        fetchPriority={priority ? "high" : undefined}
        className={className}
        data-check={check}
      />
    </picture>
  );
}
