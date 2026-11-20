# Example JPEG

The portrait of astronaut Eileen Collins is a public-domain NASA photograph.
The local original JPG was encoded from the
[scikit-image sample](https://scikit-image.org/docs/stable/api/skimage.data.html#skimage.data.astronaut).
Pixelate, Streaks, and Ringing Halo were rendered from that JPG with the
editor's coefficient codec and default settings.

To rebuild this set from another JPEG, run:

```sh
npm run generate:examples -- --input /path/to/photo.jpg
```

The presets and output filenames are configured in
`scripts/example-assets.config.json`. The generator applies each preset to a
full-image mask in the selected JPEG component and re-encodes every output
independently; the original input is copied unchanged.
