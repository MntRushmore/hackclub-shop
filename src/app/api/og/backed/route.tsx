import { ImageResponse } from 'next/og';
import { normalizeShareTier, normalizeShareNumber, shareHeadline, shareSubline } from '../../../../lib/shareCard';

/**
 * Dynamic OG image for the /backed share page (1200×630): the card a donor's
 * post renders when they share "We hold vest #042 of 100". Params are validated
 * against the shareCard allowlists, so this can only ever draw a known tier
 * name and a number 1–100 — same Satori constraints and brand styling as the
 * static homepage OG image.
 */
export const runtime = 'edge';

const RED = '#ec3750';
const ORANGE = '#ff8c37';
const DARK = '#17171d';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const tier = normalizeShareTier(searchParams.get('t'));
    const num = normalizeShareNumber(searchParams.get('n'));

    return new ImageResponse(
        (
            <div
                style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    backgroundColor: DARK,
                    padding: '72px 80px',
                    fontFamily: 'sans-serif',
                }}
            >
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                    }}
                >
                    <div style={{ display: 'flex', fontSize: 30, fontWeight: 800, letterSpacing: 6, color: RED }}>
                        HACK CLUB
                    </div>
                    {tier && (
                        <div
                            style={{
                                display: 'flex',
                                fontSize: 26,
                                fontWeight: 800,
                                letterSpacing: 3,
                                color: '#ffffff',
                                backgroundColor: RED,
                                padding: '10px 26px',
                                borderRadius: 999,
                            }}
                        >
                            {tier.toUpperCase()}
                        </div>
                    )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <div
                        style={{
                            display: 'flex',
                            fontSize: 96,
                            fontWeight: 900,
                            lineHeight: 1.02,
                            letterSpacing: -2,
                            color: '#ffffff',
                        }}
                    >
                        {shareHeadline(tier, num)}
                    </div>
                    <div
                        style={{
                            display: 'flex',
                            marginTop: 28,
                            fontSize: 34,
                            fontWeight: 600,
                            lineHeight: 1.35,
                            color: 'rgba(255,255,255,0.78)',
                            maxWidth: 980,
                        }}
                    >
                        {shareSubline(tier)}
                    </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <div
                        style={{
                            display: 'flex',
                            height: 10,
                            width: '100%',
                            borderRadius: 999,
                            backgroundImage: `linear-gradient(90deg, ${ORANGE}, ${RED})`,
                        }}
                    />
                    <div
                        style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            marginTop: 26,
                            fontSize: 26,
                            fontWeight: 700,
                            color: 'rgba(255,255,255,0.7)',
                        }}
                    >
                        <div style={{ display: 'flex' }}>shop.hackclub.com</div>
                        <div style={{ display: 'flex' }}>501(c)(3) nonprofit</div>
                    </div>
                </div>
            </div>
        ),
        { width: 1200, height: 630 },
    );
}
