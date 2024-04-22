import logging
import os
import requests
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from undetected_chromedriver import Chrome, ChromeOptions
from selenium.webdriver.common.keys import Keys
import time

class imageGenerator:
    def __init__(self, cookie_value: str):
        self.cookie_value = cookie_value

    def create(self):
        cookie = {"name": "_U", "value": self.cookie_value}
        # Create new webscraper to run parallel.
        options = ChromeOptions()
        options.add_argument("--disable-blink-features=AutomationControlled")
        options.headless = False
        driver = Chrome(options=options)
        driver.get("https://www.bing.com/chat")
        driver.add_cookie(cookie)
        searchbox = WebDriverWait(driver,5).until(EC.presence_of_element_located((By.CLASS_NAME,"cib-serp-main")))
        searchbox.send_keys("Generate a realistic image of a treehouse in a vast forest")
        searchbox.send_keys(Keys.ENTER)
        shadowHost = searchbox.shadow_root
        shadowHost2 = WebDriverWait(shadowHost,15).until(EC.presence_of_element_located((By.ID,"cib-conversation-main"))).shadow_root
        shadowHost3 = WebDriverWait(shadowHost2,15).until(EC.presence_of_element_located((By.CSS_SELECTOR,"#cib-chat-main > cib-chat-turn:nth-child(4)"))).shadow_root
        shadowHost4 = WebDriverWait(shadowHost3,15).until(EC.presence_of_element_located((By.CLASS_NAME,"response-message-group"))).shadow_root
        shadowHost5 = WebDriverWait(shadowHost4,15).until(EC.presence_of_element_located((By.CSS_SELECTOR,"cib-message:nth-child(3)"))).shadow_root
        print("In deepest shadow.")
        frame = WebDriverWait(shadowHost5,30).until(EC.presence_of_element_located((By.CSS_SELECTOR,"cib-shared:nth-child(1) > cib-overlay:nth-child(3)")))
        time.sleep(10)
        driver.switch_to.frame(frame.get_attribute("name"))
        print(frame.get_attribute("innerHTML"))
        element = WebDriverWait(driver,200).until(EC.presence_of_element_located((By.CSS_SELECTOR,"b_content")))
        print("Found element")
        image = WebDriverWait(driver,60).until(EC.presence_of_element_located((By.CLASS_NAME,"mimg")))
        print("Found image")
        image.click()

def main():
    cookie = os.getenv("BING_COOKIE_VALUE")
    driver = imageGenerator(cookie)
    driver.create()
    time.sleep(100)


if __name__ == "__main__":
    main()