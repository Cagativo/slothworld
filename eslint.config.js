export default [
  {
    files: ['rendering/**/*.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/*event*', '**/*event*/**'],
              message: 'Rendering layer must not import from event modules. Derive data outside rendering and pass it in.'
            },
            {
              group: ['**/*engine*', '**/*engine*/**'],
              message: 'Rendering layer must not import from engine modules. Derive data outside rendering and pass it in.'
            },
            {
              group: ['**/*selector*', '**/*selector*/**'],
              message: 'Rendering layer must not import from selector modules. Derive data outside rendering and pass it in.'
            },
            {
              group: ['**/*task*', '**/*task*/**'],
              message: 'Rendering layer must not import from task modules. Derive data outside rendering and pass it in.'
            }
          ]
        }
      ]
    }
  }
];
