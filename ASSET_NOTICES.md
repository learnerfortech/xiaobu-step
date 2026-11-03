# Asset notices and licensing status

The repository contains a standard MIT `LICENSE` file. Do not assume that every bundled image, audio file, font, executable, or other third-party asset is covered by that license.

This page records what is currently visible in the repository. It is not a grant of rights and does not replace checking the original source terms.

## Known asset groups requiring verification

| Repository path | What the repository currently records | Status |
|---|---|---|
| `frontend/assets/buddies/*.png` | The README identifies these companion illustrations as third-party artwork. Filenames refer to Pokémon characters. | Copyright owner, source, and redistribution permission are not documented here. Do not assume MIT applies. |
| `frontend/games/audio/pinyin/` | `sources.json` records source URLs and credits to `cmguo/PinYinSound` for pronunciation recordings. | Attribution is recorded, but the applicable license and redistribution permission have not been verified. |
| `frontend/audio/*.mp3` and `frontend/games/audio/*.mp3` | The audio manifests identify generated clips using the `zh-CN-XiaoyiNeural` Edge TTS voice. | The applicable service terms and rights for redistributing the generated audio have not been recorded. |
| `lan-server/local-speech` | A compiled executable is included alongside `lan-server/local-speech.m`. | Build provenance and redistribution terms are not documented. |

## Before redistributing or commercial use

For each asset, do one of the following:

1. Record the original creator/source, exact license, required attribution, and any restrictions; or
2. Replace it with an original asset or one whose license clearly permits the intended use.

Until verified, treat the listed assets as **not cleared for independent reuse or commercial redistribution**. Do not represent them as MIT-licensed.

When adding new assets, update this page in the same pull request.
