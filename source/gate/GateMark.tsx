import '../src/templates/designup/parts/designup.css';
import mark from '../public/images/brand/designup-logo.svg';

/**
 * The DesignUp logo for the gate, sized by the template's `--t-designup-logo-size` like the site's own Logo part. The
 * site's part reads its file from the site content, which must never enter the public gate bundle, so this one
 * imports the file directly.
 */
export function GateMark({ alt }: { alt: string }) {
  return (
    <span data-dl="designup-logo">
      <img data-dl-part="image" src={mark} alt={alt} width={582} height={614} decoding="async" />
    </span>
  );
}
