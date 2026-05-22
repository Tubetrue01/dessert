# OpenWrt Rust feed with guaranteed CI LLVM artifacts

## How to use?

After `./scripts/feeds install -a`, replace the default Rust package:

```sh
rm -rf feeds/packages/lang/rust
git clone https://github.com/sbwml/packages_lang_rust feeds/packages/lang/rust
```

This feed maintains Rust’s CI‑generated LLVM artifacts in a persistent and always‑available state.  
It ensures `llvm.download-ci-llvm = true` works reliably across Rust versions, avoiding the common 404/cleanup issues from upstream CI and providing a consistent bootstrap environment for OpenWrt builds.
