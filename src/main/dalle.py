from openai import OpenAI
import uuid
import os
import requests
from dotenv import load_dotenv

class Dalle:

    def __init__(self):
        api_key = os.getenv("OPENAI_API_KEY")
        self.client = OpenAI(api_key=api_key)

    def createImage(self, folder, prompt, quality="standard", size = "1024x1792"):
        # Quality can be low, medium or high for gpt-image-1. standard or HD for dall-e-3.
        response = self.client.images.generate(
            model="dall-e-3",
            prompt=prompt,
            n=1,
            size=size,
            quality=quality
        )
        self.downloadImage(response, folder)

    def createTestImage(self, folder, prompt, size = "256x256"):
        # Quality can be low, medium or high for gpt-image-1. standard or HD for dall-e-3.
        response = self.client.images.generate(
            model="dall-e-2", # gpt-image-1 for most high end. (0.25/portrait image in high quality).
            # dall-e-3 for DALLE 3.
            # dall-e-2 for DALLE 2 for testing. Quality cannot be included.
            prompt=prompt[:1000], # Max 1000 chars for dalle2
            n=1,
            size=size,
            # quality=quality
        )
        self.downloadImage(response, folder)
        

    def downloadImage(self, response, folder):
        # Get the image URL
        image_url = response.data[0].url

        # Create folder if it doesn't exist
        os.makedirs(folder, exist_ok=True)

        # Generate an available file name.
        base_name = "generated_image"
        ext = ".jpeg"
        file_name = f"{base_name}{uuid.uuid4().hex}{ext}"
        file_path = os.path.join(folder, file_name)

        # Download and save the image
        image_data = requests.get(image_url).content
        with open(file_path, "wb") as f:
            f.write(image_data)

        print(f"Image saved to {file_path}")
    


def main():
    load_dotenv()
    dalle = Dalle()
    dalle.createImage(
        "images/2025-07-22_01-24-35",
        "Style: dark fantasy, highly detailed, 4k realism. " \
        "A cozy medieval tavern interior at night, lit by flickering candlelight and a roaring fireplace. Wooden beams and stone walls, barrels stacked behind a rustic wooden bar. Old-fashioned mugs and tankards on tables, a barkeep serving ale to rugged adventurers and knights in armor. Warm, golden lighting with deep shadows. Smoky atmosphere, with medieval banners and hunting trophies on the walls. Style: high-detail, cinematic realism, with a touch of fantasy.",
        size="1024x1024")
    
if __name__ == "__main__":
    main()