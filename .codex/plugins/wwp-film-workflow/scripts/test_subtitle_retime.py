import unittest
from subtitle_retime import transform


class TimingTests(unittest.TestCase):
    def test_identity_preserves_text_and_overlapping_styles(self):
        source = "[Events]\nDialogue: 0,0:00:01.00,0:00:02.00,中文,,0,0,0,,字,幕\\N第二行\nDialogue: 1,0:00:01.00,0:00:02.00,法语,,0,0,0,,bonjour\n"
        output, count = transform(source, 1, 0)
        self.assertEqual(output, source)
        self.assertEqual(count, 2)

    def test_speed_and_offset(self):
        source = "Dialogue: 0,1:00:00.00,1:00:01.00,Default,,0,0,0,,text\n"
        output, _ = transform(source, 1000 / 1001, 8.862632367632614)
        self.assertIn(",1:00:05.27,1:00:06.27,", output)

    def test_invalid_corrections(self):
        source = "Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,text\n"
        for scale, offset in [(0, 0), (-1, 0), (1, -2), (float('nan'), 0), (1, float('inf'))]:
            with self.assertRaises(ValueError):
                transform(source, scale, offset)


if __name__ == '__main__':
    unittest.main()
