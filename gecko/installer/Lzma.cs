// Deer-Setup.exe's payload decoders: raw LZMA (LZMA1, as Python's lzma module writes it with
// FORMAT_RAW and FILTER_LZMA1) and the x86 BCJ filter (FILTER_X86) that makes call and jump targets in
// .exe/.dll code compress better. Written for Deer from the LZMA specification (lzma-specification.txt
// in Igor Pavlov's public-domain LZMA SDK) and the BCJ x86 algorithm as implemented in xz's liblzma
// (public domain), which is what Python uses to encode. C# 5, no unsafe code: every array access is
// bounds-checked, so damaged input ends in an exception, never in a read or write outside the buffers.
//
// Each payload block is decoded whole into memory (the output buffer is the LZMA dictionary), so the
// decoder needs no window management; blocks are independent and decoded on several threads by
// Setup.cs (PackageReader).
// SPDX-License-Identifier: MPL-2.0
using System;
using System.IO;

namespace Deer.Setup
{
    sealed class LzmaDecoder
    {
        const int NumStates = 12;
        const int PosBitsMax = 4;
        const int EndPosModelIndex = 14;
        const int NumFullDistances = 1 << (EndPosModelIndex >> 1);
        const int NumAlignBits = 4;
        const int MatchMinLen = 2;

        // Offsets into the one probability array.
        const int IsMatch = 0;
        const int IsRep = IsMatch + (NumStates << PosBitsMax);
        const int IsRepG0 = IsRep + NumStates;
        const int IsRepG1 = IsRepG0 + NumStates;
        const int IsRepG2 = IsRepG1 + NumStates;
        const int IsRep0Long = IsRepG2 + NumStates;
        const int PosSlot = IsRep0Long + (NumStates << PosBitsMax);
        const int SpecPos = PosSlot + (4 << 6);
        const int Align = SpecPos + 1 + NumFullDistances - EndPosModelIndex;
        const int LenCoder = Align + (1 << NumAlignBits);
        const int LenSize = 2 + (16 << 3) + (16 << 3) + 256; // choice, choice2, low[16][8], mid[16][8], high[256]
        const int RepLenCoder = LenCoder + LenSize;
        const int Literal = RepLenCoder + LenSize;

        readonly int lc, lp, pb;
        readonly ushort[] probs;
        byte[] input;
        int inPos;
        uint range, code;

        public LzmaDecoder(int lc, int lp, int pb)
        {
            if (lc < 0 || lc > 8 || lp < 0 || lp > 4 || pb < 0 || pb > 4) throw new InvalidDataException("bad LZMA properties");
            this.lc = lc;
            this.lp = lp;
            this.pb = pb;
            probs = new ushort[Literal + (0x300 << (lc + lp))];
        }

        static InvalidDataException Corrupt(string what)
        {
            return new InvalidDataException("damaged LZMA data (" + what + ")");
        }

        uint Bit(int i)
        {
            uint p = probs[i];
            uint bound = (range >> 11) * p;
            uint bit;
            if (code < bound)
            {
                range = bound;
                probs[i] = (ushort)(p + ((2048 - p) >> 5));
                bit = 0;
            }
            else
            {
                range -= bound;
                code -= bound;
                probs[i] = (ushort)(p - (p >> 5));
                bit = 1;
            }
            if (range < (1u << 24))
            {
                range <<= 8;
                code = (code << 8) | input[inPos++];
            }
            return bit;
        }

        uint BitTree(int b, int numBits)
        {
            uint m = 1;
            for (int i = 0; i < numBits; i++) m = (m << 1) | Bit(b + (int)m);
            return m - (1u << numBits);
        }

        uint ReverseBitTree(int b, int numBits)
        {
            uint m = 1, symbol = 0;
            for (int i = 0; i < numBits; i++)
            {
                uint bit = Bit(b + (int)m);
                m = (m << 1) | bit;
                symbol |= bit << i;
            }
            return symbol;
        }

        uint DirectBits(int numBits)
        {
            uint result = 0;
            do
            {
                range >>= 1;
                code -= range;
                uint t = 0 - (code >> 31);
                code += range & t;
                if (code == range) throw Corrupt("direct bits");
                if (range < (1u << 24))
                {
                    range <<= 8;
                    code = (code << 8) | input[inPos++];
                }
                result = (result << 1) + (t + 1);
            }
            while (--numBits > 0);
            return result;
        }

        uint Length(int b, int posState)
        {
            if (Bit(b) == 0) return BitTree(b + 2 + (posState << 3), 3);
            if (Bit(b + 1) == 0) return 8 + BitTree(b + 2 + (16 << 3) + (posState << 3), 3);
            return 16 + BitTree(b + 2 + (32 << 3), 8);
        }

        uint Distance(uint len)
        {
            uint lenState = len < 3 ? len : 3;
            uint posSlot = BitTree(PosSlot + (int)(lenState << 6), 6);
            if (posSlot < 4) return posSlot;
            int numDirectBits = (int)(posSlot >> 1) - 1;
            uint dist = (2 | (posSlot & 1)) << numDirectBits;
            if (posSlot < EndPosModelIndex) return dist + ReverseBitTree(SpecPos + (int)(dist - posSlot), numDirectBits);
            dist += DirectBits(numDirectBits - NumAlignBits) << NumAlignBits;
            return dist + ReverseBitTree(Align, NumAlignBits);
        }

        // Decodes the raw LZMA stream compressed[0..inLength) into output[0..outLength). The stream must
        // produce exactly outLength bytes, end with the end-of-payload marker (Python's raw LZMA1 encoder
        // always writes one) and use exactly inLength bytes; anything else throws InvalidDataException.
        public void Decode(byte[] compressed, int inLength, byte[] output, int outLength)
        {
            if (outLength < 0 || outLength > output.Length) throw new ArgumentOutOfRangeException("outLength");
            if (inLength < 0 || inLength > compressed.Length) throw new ArgumentOutOfRangeException("inLength");
            for (int i = 0; i < probs.Length; i++) probs[i] = 1024;
            input = compressed;
            inPos = 0;
            try
            {
                if (inLength < 5 || input[0] != 0) throw Corrupt("header");
                range = 0xFFFFFFFF;
                code = 0;
                for (inPos = 1; inPos < 5; inPos++) code = (code << 8) | input[inPos];
                if (code == range) throw Corrupt("header");
                Run(output, outLength);
                if (inPos != inLength) throw Corrupt(inPos < inLength ? (inLength - inPos) + " bytes after the end marker" : "unexpected end");
            }
            catch (IndexOutOfRangeException)
            {
                throw Corrupt("unexpected end");
            }
            finally
            {
                input = null;
            }
        }

        void Run(byte[] output, int outLength)
        {
            int pos = 0;
            uint state = 0, rep0 = 0, rep1 = 0, rep2 = 0, rep3 = 0;
            int pbMask = (1 << pb) - 1, lpMask = (1 << lp) - 1, lcShift = 8 - lc;
            while (true)
            {
                int posState = pos & pbMask;
                if (Bit(IsMatch + (int)(state << PosBitsMax) + posState) == 0)
                {
                    if (pos == outLength) throw Corrupt("data after the expected end");
                    int prev = pos > 0 ? output[pos - 1] : 0;
                    int b = Literal + 0x300 * (((pos & lpMask) << lc) + (prev >> lcShift));
                    uint symbol = 1;
                    if (state >= 7)
                    {
                        uint matchByte = output[pos - (int)rep0 - 1];
                        do
                        {
                            uint matchBit = (matchByte >> 7) & 1;
                            matchByte <<= 1;
                            uint bit = Bit(b + (int)(((1 + matchBit) << 8) + symbol));
                            symbol = (symbol << 1) | bit;
                            if (matchBit != bit) break;
                        }
                        while (symbol < 0x100);
                    }
                    while (symbol < 0x100) symbol = (symbol << 1) | Bit(b + (int)symbol);
                    output[pos++] = (byte)symbol;
                    state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6;
                    continue;
                }

                uint len;
                if (Bit(IsRep + (int)state) != 0)
                {
                    if (pos == outLength) throw Corrupt("data after the expected end");
                    if (pos == 0) throw Corrupt("repeat before any data");
                    if (Bit(IsRepG0 + (int)state) == 0)
                    {
                        if (Bit(IsRep0Long + (int)(state << PosBitsMax) + posState) == 0)
                        {
                            state = state < 7 ? 9u : 11u;
                            output[pos] = output[pos - (int)rep0 - 1];
                            pos++;
                            continue;
                        }
                    }
                    else
                    {
                        uint dist;
                        if (Bit(IsRepG1 + (int)state) == 0) dist = rep1;
                        else
                        {
                            if (Bit(IsRepG2 + (int)state) == 0) dist = rep2;
                            else
                            {
                                dist = rep3;
                                rep3 = rep2;
                            }
                            rep2 = rep1;
                        }
                        rep1 = rep0;
                        rep0 = dist;
                    }
                    len = Length(RepLenCoder, posState);
                    state = state < 7 ? 8u : 11u;
                }
                else
                {
                    rep3 = rep2;
                    rep2 = rep1;
                    rep1 = rep0;
                    len = Length(LenCoder, posState);
                    state = state < 7 ? 7u : 10u;
                    rep0 = Distance(len);
                    if (rep0 == 0xFFFFFFFF)
                    {
                        if (pos != outLength) throw Corrupt("end marker " + (outLength - pos) + " bytes early");
                        if (code != 0) throw Corrupt("end marker");
                        return;
                    }
                    if (pos == outLength) throw Corrupt("data after the expected end");
                    if (rep0 >= (uint)pos) throw Corrupt("distance beyond the start");
                }
                int n = (int)len + MatchMinLen;
                if (n > outLength - pos) throw Corrupt("match beyond the expected end");
                int src = pos - (int)rep0 - 1;
                if (rep0 >= (uint)n - 1)
                {
                    Buffer.BlockCopy(output, src, output, pos, n); // source and destination do not overlap
                    pos += n;
                }
                else
                {
                    for (int end = pos + n; pos < end; ) output[pos++] = output[src++];
                }
            }
        }
    }

    // The x86 BCJ filter's decoder (liblzma simple/x86.c, decoding direction), applied once to a whole
    // block with the stream position starting at 0, as Python's encoder applied it to that block.
    static class BcjX86
    {
        static readonly bool[] AllowedStatus = { true, true, true, false, true, false, false, false };
        static readonly int[] BitNumber = { 0, 1, 2, 2, 3, 3, 3, 3 };

        static bool Test86MSByte(byte b) { return b == 0 || b == 0xFF; }

        public static void Decode(byte[] buffer, int size)
        {
            if (size < 5) return;
            uint prevMask = 0;
            uint prevPos = unchecked((uint)-5);
            int limit = size - 5;
            int pos = 0;
            while (pos <= limit)
            {
                byte b = buffer[pos];
                if (b != 0xE8 && b != 0xE9)
                {
                    pos++;
                    continue;
                }
                uint offset = unchecked((uint)pos - prevPos);
                prevPos = (uint)pos;
                if (offset > 5) prevMask = 0;
                else
                {
                    for (uint i = 0; i < offset; i++)
                    {
                        prevMask &= 0x77;
                        prevMask <<= 1;
                    }
                }
                b = buffer[pos + 4];
                if (Test86MSByte(b) && AllowedStatus[(prevMask >> 1) & 0x7] && (prevMask >> 1) < 0x10)
                {
                    uint src = ((uint)b << 24) | ((uint)buffer[pos + 3] << 16) | ((uint)buffer[pos + 2] << 8) | buffer[pos + 1];
                    uint dest;
                    while (true)
                    {
                        dest = unchecked(src - ((uint)pos + 5));
                        if (prevMask == 0) break;
                        int index = BitNumber[prevMask >> 1];
                        b = (byte)(dest >> (24 - index * 8));
                        if (!Test86MSByte(b)) break;
                        src = dest ^ ((1u << (32 - index * 8)) - 1);
                    }
                    buffer[pos + 4] = (byte)~(((dest >> 24) & 1) - 1);
                    buffer[pos + 3] = (byte)(dest >> 16);
                    buffer[pos + 2] = (byte)(dest >> 8);
                    buffer[pos + 1] = (byte)dest;
                    pos += 5;
                    prevMask = 0;
                }
                else
                {
                    pos++;
                    prevMask |= 1;
                    if (Test86MSByte(b)) prevMask |= 0x10;
                }
            }
        }
    }

    // CRC-32 (IEEE, the zlib one): each payload block carries the CRC of its decoded bytes.
    static class Crc32
    {
        static readonly uint[] Table = MakeTable();

        static uint[] MakeTable()
        {
            var t = new uint[256];
            for (uint i = 0; i < 256; i++)
            {
                uint c = i;
                for (int k = 0; k < 8; k++) c = (c & 1) != 0 ? 0xEDB88320u ^ (c >> 1) : c >> 1;
                t[i] = c;
            }
            return t;
        }

        public static uint Compute(byte[] data, int length)
        {
            uint c = 0xFFFFFFFF;
            for (int i = 0; i < length; i++) c = Table[(c ^ data[i]) & 0xFF] ^ (c >> 8);
            return c ^ 0xFFFFFFFF;
        }
    }
}
