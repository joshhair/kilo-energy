import { describe, it, expect } from 'vitest';
import {
  sortForSelection,
  sortForManagement,
  sortReferenceData,
  sortFinancers,
} from '@/lib/sorting';

describe('sortForSelection — pickers', () => {
  it('filters inactive and sorts alphabetically by first name', () => {
    const users = [
      { firstName: 'Zach', lastName: 'Black', active: true },
      { firstName: 'Alex', lastName: 'Rivera', active: false },
      { firstName: 'Alex', lastName: 'Morgan', active: true },
      { firstName: 'maria', lastName: 'Santos', active: true },
    ];
    const out = sortForSelection(users);
    expect(out.map((u) => `${u.firstName} ${u.lastName}`)).toEqual([
      'Alex Morgan',
      'maria Santos',
      'Zach Black',
    ]);
  });

  it('treats missing active as active (defensive)', () => {
    const users = [
      { firstName: 'Alex' },
      { firstName: 'Bert' },
    ];
    expect(sortForSelection(users)).toHaveLength(2);
  });

  it('falls back to name field if firstName is absent', () => {
    const users = [
      { name: 'Zoe Chen', active: true },
      { name: 'Avery Lin', active: true },
    ];
    expect(sortForSelection(users).map((u) => u.name)).toEqual(['Avery Lin', 'Zoe Chen']);
  });

  it('tiebreaks on last name for duplicate first names', () => {
    const users = [
      { firstName: 'Chris', lastName: 'Young', active: true },
      { firstName: 'Chris', lastName: 'Abbott', active: true },
    ];
    expect(sortForSelection(users).map((u) => u.lastName)).toEqual(['Abbott', 'Young']);
  });
});

describe('sortForManagement — admin lists', () => {
  it('puts active users first, then inactive; alpha by last name within each group', () => {
    const users = [
      { firstName: 'Zack', lastName: 'Young', active: true },
      { firstName: 'Adam', lastName: 'Zion', active: false },
      { firstName: 'Beth', lastName: 'Adams', active: true },
      { firstName: 'Cara', lastName: 'Brown', active: false },
    ];
    const out = sortForManagement(users);
    expect(out.map((u) => `${u.active ? '+' : '-'}${u.lastName}`)).toEqual([
      '+Adams',   // active, A
      '+Young',   // active, Y
      '-Brown',   // inactive, B
      '-Zion',    // inactive, Z
    ]);
  });
});

describe('sortReferenceData — installers / products', () => {
  it('alphabetizes by name, case-insensitive', () => {
    const items = [{ name: 'ESP' }, { name: 'BVI' }, { name: 'SolarTech' }, { name: 'aurora' }];
    expect(sortReferenceData(items).map((i) => i.name)).toEqual(['aurora', 'BVI', 'ESP', 'SolarTech']);
  });
});

describe('sortFinancers', () => {
  it('pins Cash first, then alphabetical', () => {
    const items = [
      { name: 'Goodleap' },
      { name: 'Sunlight' },
      { name: 'Cash' },
      { name: 'Enfin' },
    ];
    expect(sortFinancers(items).map((i) => i.name)).toEqual(['Cash', 'Enfin', 'Goodleap', 'Sunlight']);
  });

  it('handles case-insensitive Cash', () => {
    const items = [{ name: 'Enfin' }, { name: 'cash' }];
    expect(sortFinancers(items).map((i) => i.name)).toEqual(['cash', 'Enfin']);
  });

  it('works when Cash is absent', () => {
    const items = [{ name: 'Sunlight' }, { name: 'Goodleap' }];
    expect(sortFinancers(items).map((i) => i.name)).toEqual(['Goodleap', 'Sunlight']);
  });
});
