// Official Bacca brand mark sourced from bacca.ai/favicon.svg.
// Path data is identical to the SVG shipped on the marketing site so the in-app
// header reads as native to anyone who's seen the company logo before.

type Props = {
  size?: number;
  className?: string;
};

export function BaccaMark({ size = 32, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Bacca"
    >
      <rect width="32.0005" height="32.0005" rx="8.00013" fill="#19E2B0" />
      <rect x="6" y="12.0002" width="20.0003" height="8.00013" rx="4.00006" fill="#070A0D" />
    </svg>
  );
}
