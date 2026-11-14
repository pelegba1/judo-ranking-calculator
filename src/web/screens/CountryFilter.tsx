import { S } from '../strings';

/** "Country" select: every country of the list, or one IOC code. */
export function CountryFilter({ id, value, options, onChange }: {
  id: string; value: string | undefined; options: string[]; onChange: (country: string | undefined) => void;
}) {
  return (
    <div className="country-filter">
      <label htmlFor={id}>{S.countryLabel}</label>
      <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">{S.countryAll}</option>
        {options.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      {value && (
        <button type="button" className="btn btn-small" onClick={() => onChange(undefined)}>{S.countryClear}</button>
      )}
    </div>
  );
}
