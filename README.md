# Sticker Studio

A playful, kawaii-inspired photo booth for making cute photo strips right in your browser.

Choose from classic photo strips and screenshot-inspired 2-column grid layouts, with up to six photos per session. Pick one of six designs, optionally add stickers and a caption to the strip footer, then download the finished strip as a PNG or video. Download an animated GIF that cycles through the captured photos without the strip layout. The date is printed once in the strip footer.

GIF export uses gif.js and the included GIF worker. Video export uses the browser's canvas capture and `MediaRecorder` APIs. It downloads as MP4 when the browser supports MP4 recording, and otherwise falls back to WebM. Use a current browser with support for at least one of those formats.