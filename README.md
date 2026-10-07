# Craidd Studio

Craidd Studio is a Linux desktop IDE for projects and solutions described by
`.craidd` and `.cln` files. It uses Tauri, React, and Rust.

See [the documentation index](docs/README.md) for the project model, current
designs, and working protocol.

## Build and check

```sh
npm install
npm run build
cd src-tauri
cargo test --lib
```

Run the desktop app from the repository root with `npm run tauri dev`.
