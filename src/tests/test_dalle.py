import os
import tempfile
from unittest.mock import patch, MagicMock
from main.dalle import Dalle

class TestDalle:

    @patch("main.dalle.OpenAI")
    @patch("main.dalle.requests.get")
    def test_create_test_image_downloads_file(self, mock_requests_get, mock_openai):
        # Setup temp folder
        with tempfile.TemporaryDirectory() as tmpdir:
            # Mock OpenAI response
            mock_image_data = MagicMock()
            mock_image_data.url = "https://fake-url.com/fake-image.png"
            
            mock_response = MagicMock()
            mock_response.data = [mock_image_data]

            mock_client = MagicMock()
            mock_client.images.generate.return_value = mock_response
            mock_openai.return_value = mock_client

            # Mock requests.get content
            mock_requests_get.return_value.content = b"fake_image_data"

            dalle = Dalle()
            dalle.createTestImage(tmpdir, "a test prompt", "low", size="256x256")

            # Check file exists in folder
            files = os.listdir(tmpdir)
            assert any(f.startswith("generated_image") and f.endswith(".jpeg") for f in files)

            # Check OpenAI called with expected model
            mock_client.images.generate.assert_called_once_with(
                model="dall-e-2",
                prompt="a test prompt",
                n=1,
                size="256x256",
            )

            # Check image was requested from the mocked URL
            mock_requests_get.assert_called_once_with("https://fake-url.com/fake-image.png")

    @patch("main.dalle.OpenAI")
    def test_create_image_calls_dalle3_model(self, mock_openai):
        mock_response = MagicMock()
        mock_response.data = [MagicMock(url="http://example.com/img.png")]
        mock_client = MagicMock()
        mock_client.images.generate.return_value = mock_response
        mock_openai.return_value = mock_client

        dalle = Dalle()
        with patch("main.dalle.requests.get") as mock_requests_get, tempfile.TemporaryDirectory() as tmpdir:
            mock_requests_get.return_value.content = b"data"
            dalle.createImage(tmpdir, "sunset", "standard", "1024x1024")

        mock_client.images.generate.assert_called_once_with(
            model="dall-e-3",
            prompt="sunset",
            n=1,
            size="1024x1024",
            quality="standard"
        )

    @patch("main.dalle.requests.get")
    def test_download_image_increments_filename(self, mock_requests_get):
        with tempfile.TemporaryDirectory() as tmpdir:
            # Pre-create a file to simulate conflict
            first_path = os.path.join(tmpdir, "generated_image.jpeg")
            with open(first_path, "wb") as f:
                f.write(b"existing")

            mock_response = MagicMock()
            mock_response.data = [MagicMock(url="https://fake.com/image2.jpeg")]
            mock_requests_get.return_value.content = b"new_image"

            dalle = Dalle()
            dalle.downloadImage(mock_response, tmpdir)

            # Should have saved a new file with _1 suffix
            new_file_path = os.path.join(tmpdir, "generated_image_1.jpeg")
            assert os.path.exists(new_file_path)

            # Ensure contents were written
            with open(new_file_path, "rb") as f:
                assert f.read() == b"new_image"
