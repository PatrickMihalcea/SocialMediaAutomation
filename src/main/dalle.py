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
        "realistic, highly detailed, 4k realism. " \
        "From an aerial view, capture a tightly packed, multilevel interior loft home. At the center forefront is a cozy living space with a plush rug, small coffee table, and a comfortable couch. To the left, spiral stairs elegantly wind upwards to a small but efficient bedroom with a double bed and built-in shelves. To the right, a compact kitchen area displays a minimalist design with a breakfast bar and two stools. Large windows in the midground flood the space with soft, natural light. Outside, cityscape silhouettes are visible through the glass, slightly reflected on the windows. The atmosphere exudes an harmonious blend of modern minimalism, with warm sunlight illuminating wooden floors. The entire scene is encompassed by calm, homely vibes, taking advantage of every inch of space with thoughtful and stylish detailing.")
    
if __name__ == "__main__":
    main()