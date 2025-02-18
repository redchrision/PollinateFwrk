const path = require('path');

module.exports = {
  mode: 'development', // or 'production'
  entry: './lib/lib.ts', // Adjust this to your main TypeScript file
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'pollinate.js',
    library: 'Pollinate',
    libraryTarget: 'umd', // Universal Module Definition for compatibility
    globalObject: 'this' // Make UMD build work in Node.js and browser environments
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.json']
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: [
          {
            loader: 'babel-loader',
            options: {
              presets: [
                ['@babel/preset-env', { targets: "defaults" }],
                '@babel/preset-typescript',
              ]
            }
          }
        ],
        exclude: /node_modules/
      }
    ]
  }
};