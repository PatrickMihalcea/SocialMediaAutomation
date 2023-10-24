import os
import openai
from dotenv import load_dotenv
load_dotenv()
import logging
from dalle3 import Dalle

# Initialize the OpenAI API client
openai.api_key = os.getenv("OPENAI_API_KEY")

# Text to send as a prompt to the model
themes = """Forest, sunset, heaven, shimmer, white, shiny, waterfall, nature, bloom, sky, stars
            cliff, view"""
themes2 = """Interior, house, design, dark, shiny, marble, open space, fire place, kitchen, mysterious, cozy"""
prompt = """Generate a detailed image generation prompt using 
            exactly four of the following keywords: """ + themes2 + """. Keep the 
            description to 100 words or less."""

# Make an API call to generate text
response = openai.Completion.create(
    engine="text-davinci-003",  # Specify the GPT-3.5 engine
    prompt=prompt,
    max_tokens=100,  # Adjust the maximum number of tokens in the response as needed
    n = 1 # Number of responses to generate
)

# Extract the generated text
image_prompt = response.choices[0].text

# Generate Image using DALLE3 Unofficial API.
# Need Cookie. Find by going to the Bing Chat page, open dev tools (CMD + OPT + I).
# Click on storage, scroll to _U, and copy the value. Paste on .env file.
cookie = os.getenv("BING_COOKIE_VALUE")
logging.basicConfig(level=logging.INFO)
dalle = Dalle(cookie)
dalle.create(image_prompt)
urls = dalle.get_urls()
dalle.download(urls, "./images")

print(image_prompt)

