export default [
  { type: 'file', role: 'system', source: 'system.md' },

  { type: 'file', role: 'user', source: 'part1.md' },

  { type: 'history', slice: [0, -3] },

  { type: 'file', role: 'user', source: 'part2.md' },

  { type: 'history', slice: [-3] },

  { type: 'pending', role: 'user' }
];
