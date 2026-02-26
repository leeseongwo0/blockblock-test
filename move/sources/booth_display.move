module blockblock::booth_display {
    use std::string;
    use sui::display;
    use sui::package;
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};

    use blockblock::booth_nft::BoothNFT;

    public struct BOOTH_DISPLAY has drop {}

    fun init(otw: BOOTH_DISPLAY, ctx: &mut TxContext) {
        let keys = vector[
            string::utf8(b"name"),
            string::utf8(b"description"),
            string::utf8(b"image"),
            string::utf8(b"project_url"),
            string::utf8(b"creator"),
            string::utf8(b"link"),
        ];

        let values = vector[
            string::utf8(b"{name}"),
            string::utf8(b"BlockBlock booth commemorative NFT"),
            string::utf8(b"{image_url}"),
            string::utf8(b"https://blockblock-nft.vercel.app"),
            string::utf8(b"BlockBlock Booth"),
            string::utf8(b"https://blockblock-nft.vercel.app"),
        ];

        let publisher = package::claim(otw, ctx);
        let mut nft_display = display::new_with_fields<BoothNFT>(&publisher, keys, values, ctx);
        display::update_version(&mut nft_display);

        transfer::public_transfer(publisher, tx_context::sender(ctx));
        transfer::public_transfer(nft_display, tx_context::sender(ctx));
    }
}
