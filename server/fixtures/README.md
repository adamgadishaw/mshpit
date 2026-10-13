# Synthetic converter fixture

`hevc-hlg-rotated.mov` is generated test media, not member content.
SHA-256: `bb364394dca1b15fc0243baa6211572fe31a93321477d258811194ef5ec4cf9d`.
640×360, 30000/1001 fps, 3.003 seconds, HEVC Main 10 `hvc1`, BT.2020
HLG, 90° display matrix, AAC 5.1 with a 1000 Hz synthetic tone. The
converter must produce 360×640 BT.709 SDR H.264/AAC stereo with no rotation.

Generated using FFmpeg 9.0.2 with these steps (local paths omitted):

```sh
ffmpeg -f lavfi -i testsrc2=size=640x360:rate=30000/1001 \
  -f lavfi -i sine=frequency=1000:sample_rate=48000 -t 3 \
  -vf 'zscale=pin=bt709:tin=bt709:min=bt709:rin=limited:p=bt2020:t=arib-std-b67:m=bt2020nc:r=limited:npl=100,format=yuv420p10le' \
  -c:v libx265 -preset ultrafast -x265-params pools=1:frame-threads=1:log-level=error \
  -tag:v hvc1 -color_primaries bt2020 -color_trc arib-std-b67 -colorspace bt2020nc \
  -c:a pcm_s16le -ac 6 unrotated.mov
ffmpeg -i unrotated.mov -c:v copy -c:a aac -ac 6 -b:a 256k audio.mov
ffmpeg -noautorotate -display_rotation 90 -i audio.mov -c copy hevc-hlg-rotated.mov
```

The checked-in fixture lets the production image exercise its HEVC decoder
without adding a HEVC encoder dependency. It does not establish physical-phone
playback or calibrated HDR appearance. PQ/HLG synthetic conversions also run
in the image self-test; larger rational/VFR, audio, repeat and interruption
checks live in `scripts/verify-video-converter.mjs`.
