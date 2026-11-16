import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { app } from './app.js';

const PORT = Number(process.env.PORT || 3000);

// Serve built client static assets when running standalone Node server
const clientDistDir = path.resolve(process.cwd(), 'dist/client');
if (fs.existsSync(clientDistDir)) {
  app.use(express.static(clientDistDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      next();
      return;
    }
    res.sendFile(path.join(clientDistDir, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[BlueFlame] Platform server running at http://0.0.0.0:${PORT}`);
});
