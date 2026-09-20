import Image from "next/image";
/** Optimize curated photos; user-supplied HTTPS images never go through the server image proxy. */
export function Photo({
  src,
  alt,
  fill,
  sizes,
  priority,
}: {
  src: string;
  alt: string;
  fill?: boolean;
  sizes?: string;
  priority?: boolean;
}) {
  if (src.startsWith("https://images.unsplash.com/") || src.startsWith("/"))
    return (
      <Image
        {...{ src, alt, fill, sizes, priority }}
        unoptimized={src.endsWith(".svg")}
      />
    );
  return (
    <img
      src={src}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      style={
        fill
          ? { position: "absolute", inset: 0, width: "100%", height: "100%" }
          : undefined
      }
    />
  );
}
