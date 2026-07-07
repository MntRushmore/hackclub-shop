# Product photo drop box

Drop product photos in this folder and tell Claude. They'll be optimized,
moved into `public/`, deployed, and wired into the Stripe catalog config
(`image_url` / `thumbnail_url`), which is what the tier cards, product pages,
and checkout thumbnails read.

Any filename works, but names like these make it obvious what goes where:

## Tier cards (one hero shot per tier)

- `supporter.jpg` — Supporter ($25, sticker pack)
- `friend.jpg` — Friend ($100, mug or tote)
- `champion.jpg` — Champion ($150, tee or cap)
- `patron.jpg` — Patron ($250, sweatshirts)
- `philanthropist.jpg` — Philanthropist ($500, numbered vest)
- `founders-circle.jpg` — Parents Founders Circle ($1,000+, pick any two)

## Individual gift pieces (shown in gift pickers)

- `vest.jpg` — Numbered vest
- `college-sweatshirt.jpg`
- `mom-sweatshirt.jpg`
- `tee.jpg`
- `cap.jpg`
- `mug.jpg`
- `tote.jpg`
- `stickers.jpg`

JPG/PNG/WebP all fine. Bigger is better (they get resized down); square or
4:3 crops well on the cards.

Nothing in this folder ships to the site directly — it's an inbox, and files
here are processed by hand.
