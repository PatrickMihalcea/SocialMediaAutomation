from openai import OpenAI
import base64
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

    def createTestImage(self, folder, prompt, quality, size = "256x256"):
        # Quality can be low, medium or high for gpt-image-1. standard or HD for dall-e-3.
        response = self.client.images.generate(
            model="dall-e-2", # gpt-image-1 for most high end. (0.25/portrait image in high quality).
            # dall-e-3 for DALLE 3.
            # dall-e-2 for DALLE 2 for testing. Quality cannot be included.
            prompt=prompt,
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

        # Generate an available file name like generated_image.png, generated_image_1.png, ...
        base_name = "generated_image"
        ext = ".jpeg"
        counter = 0

        while counter <= 100:
            if counter == 0:
                file_name = f"{base_name}{ext}"
            else:
                file_name = f"{base_name}_{counter}{ext}"
            
            file_path = os.path.join(folder, file_name)
            
            if not os.path.exists(file_path):
                break
            
            counter += 1

        # Download and save the image
        image_data = requests.get(image_url).content
        with open(file_path, "wb") as f:
            f.write(image_data)

        print(f"Image saved to {file_path}")
    


def main():
    dalle = Dalle()
    dalle.createImage(
        "images/2025-07-14_13-01-57",
        "a realistic, highly detailed, cinematic, 4k realism image for: " \
        "In this captivating image, a Forest Traveler is seen navigating their way through a dense forest. The camera angle captures the traveler in the center, with a sturdy Walking stick in hand and a backpack on their back. The background is filled with tall trees, creating a sense of mystique and adventure. The view from the traveler's perspective showcases the vastness and beauty of the forest. Soft lighting peeks through the leaves, creating a serene and peaceful atmosphere. In the foreground, a Tent is set up, and nearby are Insect repellent and a pile of Firewood. Fresh Forest berries can also be seen, indicating the traveler's resourcefulness and connection to nature. The image perfectly captures the wanderlust and resilience of a true adventurer.",
        "standard")
    
if __name__ == "__main__":
    main()