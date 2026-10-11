import { PLATFORM_LABEL, PLATFORMS } from "../issues/keys";
import type { Platform } from "../types";

export function PlatformField({
  value,
  onChange,
}: {
  value: Platform[];
  onChange: (next: Platform[]) => void;
}) {
  function toggle(platform: Platform) {
    const chosen = value.includes(platform) ? value.filter((item) => item !== platform) : [...value, platform];
    onChange(PLATFORMS.filter((item) => chosen.includes(item)));
  }

  return (
    <fieldset className="platform-picks">
      <legend>Platform</legend>
      {PLATFORMS.map((platform) => (
        <label className="check-line" key={platform}>
          <input type="checkbox" checked={value.includes(platform)} onChange={() => toggle(platform)} />
          {PLATFORM_LABEL[platform]}
        </label>
      ))}
    </fieldset>
  );
}
